
DO $$ BEGIN
  CREATE TYPE public.invitation_mode AS ENUM ('magic_link','temp_password');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.invitation_status AS ENUM ('pending','sent','accepted','revoked','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  display_name text,
  role public.app_role NOT NULL DEFAULT 'author',
  mode public.invitation_mode NOT NULL DEFAULT 'magic_link',
  status public.invitation_status NOT NULL DEFAULT 'pending',
  source text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  auth_user_id uuid,
  invited_by uuid,
  sent_at timestamptz,
  accepted_at timestamptz,
  expires_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_invitations_tenant_idx ON public.user_invitations(tenant_id);
CREATE INDEX IF NOT EXISTS user_invitations_email_idx ON public.user_invitations(lower(email));
CREATE INDEX IF NOT EXISTS user_invitations_status_idx ON public.user_invitations(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_invitations TO authenticated;
GRANT ALL ON public.user_invitations TO service_role;

ALTER TABLE public.user_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invitations_admin_all" ON public.user_invitations;
CREATE POLICY "invitations_admin_all" ON public.user_invitations
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
    AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
  )
  WITH CHECK (
    tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
    AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
  );

DROP TRIGGER IF EXISTS trg_user_invitations_updated_at ON public.user_invitations;
CREATE TRIGGER trg_user_invitations_updated_at
  BEFORE UPDATE ON public.user_invitations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
