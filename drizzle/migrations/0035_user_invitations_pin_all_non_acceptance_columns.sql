CREATE OR REPLACE FUNCTION public.user_invitations_pin_admin_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_service_role_caller()
     OR public.has_role(auth.uid(), 'admin'::public.app_role)
     OR public.has_role(auth.uid(), 'super_admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  NEW.id           := OLD.id;
  NEW.role         := OLD.role;
  NEW.tenant_id    := OLD.tenant_id;
  NEW.email        := OLD.email;
  NEW.display_name := OLD.display_name;
  NEW.mode         := OLD.mode;
  NEW.source       := OLD.source;
  NEW.metadata     := OLD.metadata;
  NEW.invited_by   := OLD.invited_by;
  NEW.expires_at   := OLD.expires_at;
  NEW.send_count   := OLD.send_count;
  NEW.sent_at      := OLD.sent_at;
  NEW.last_error   := OLD.last_error;
  NEW.created_at   := OLD.created_at;
  NEW.auth_user_id := OLD.auth_user_id;

  IF NEW.status <> OLD.status AND NEW.status <> 'accepted'::public.invitation_status THEN
    RAISE EXCEPTION 'user_invitations: recipient may only accept';
  END IF;

  IF NEW.status = 'accepted'::public.invitation_status AND NEW.accepted_at IS NULL THEN
    NEW.accepted_at := now();
  END IF;

  IF NEW.status = OLD.status THEN
    NEW.accepted_at := OLD.accepted_at;
  END IF;

  RETURN NEW;
END;
$$;