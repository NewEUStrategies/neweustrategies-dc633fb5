
-- 1. CREATE TABLE
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'system',
  title_pl text NOT NULL,
  title_en text,
  body_pl text,
  body_en text,
  href text,
  icon text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_recent_idx
  ON public.notifications (user_id, tenant_id, created_at DESC);
CREATE INDEX notifications_user_unread_idx
  ON public.notifications (user_id, tenant_id)
  WHERE read_at IS NULL;

-- 2. GRANTS
GRANT SELECT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

-- 3. RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- 4. POLICIES (tenant isolation + auth.uid())
CREATE POLICY "notifications_select_own"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    AND tenant_id = public.current_tenant_id()
  );

CREATE POLICY "notifications_update_own_read"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id
    AND tenant_id = public.current_tenant_id()
  )
  WITH CHECK (
    auth.uid() = user_id
    AND tenant_id = public.current_tenant_id()
  );

CREATE POLICY "notifications_delete_own"
  ON public.notifications FOR DELETE
  TO authenticated
  USING (
    auth.uid() = user_id
    AND tenant_id = public.current_tenant_id()
  );

-- No INSERT policy for authenticated: only service_role can insert (system events)

-- Validation trigger: enforce tenant_id matches recipient's profile tenant
CREATE OR REPLACE FUNCTION public.notifications_enforce_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_profile_tenant
    FROM public.profiles
   WHERE id = NEW.user_id;

  IF v_profile_tenant IS NULL THEN
    RAISE EXCEPTION 'notifications: recipient has no profile/tenant';
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM v_profile_tenant THEN
    RAISE EXCEPTION 'notifications: tenant_id (%) must match recipient tenant (%)',
      NEW.tenant_id, v_profile_tenant;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER notifications_enforce_tenant_trg
  BEFORE INSERT OR UPDATE OF tenant_id, user_id ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_enforce_tenant();

-- Enable realtime
ALTER TABLE public.notifications REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
