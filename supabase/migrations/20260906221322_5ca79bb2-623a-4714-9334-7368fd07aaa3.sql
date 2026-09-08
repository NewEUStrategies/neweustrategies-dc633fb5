CREATE OR REPLACE FUNCTION public.accept_my_user_invitation()
RETURNS TABLE(invitation_id uuid, accepted_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
  v_tenant_id uuid;
  v_invitation_id uuid;
  v_accepted_at timestamptz := now();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  SELECT lower(trim(p.email)), p.tenant_id
    INTO v_email, v_tenant_id
    FROM public.profiles p
   WHERE p.id = v_user_id;

  IF v_email IS NULL OR v_tenant_id IS NULL THEN
    RETURN;
  END IF;

  SELECT ui.id
    INTO v_invitation_id
    FROM public.user_invitations ui
   WHERE ui.tenant_id = v_tenant_id
     AND lower(trim(ui.email)) = v_email
     AND ui.auth_user_id = v_user_id
     AND ui.status IN ('pending'::public.invitation_status, 'sent'::public.invitation_status, 'failed'::public.invitation_status)
   ORDER BY ui.created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF v_invitation_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.user_invitations
     SET status = 'accepted'::public.invitation_status,
         accepted_at = v_accepted_at,
         last_error = NULL
   WHERE id = v_invitation_id;

  PERFORM public.crm_upsert_lead_from_profile(v_user_id);

  UPDATE public.crm_leads
     SET last_activity_at = v_accepted_at,
         updated_at = v_accepted_at
   WHERE tenant_id = v_tenant_id
     AND email_norm = v_email;

  RETURN QUERY SELECT v_invitation_id, v_accepted_at;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_my_user_invitation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_my_user_invitation() TO authenticated, service_role;