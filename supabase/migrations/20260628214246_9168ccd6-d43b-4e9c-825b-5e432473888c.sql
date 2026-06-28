CREATE TABLE IF NOT EXISTS public.impersonation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  ip TEXT,
  user_agent TEXT,
  reason TEXT
);
GRANT SELECT ON public.impersonation_sessions TO authenticated;
GRANT ALL ON public.impersonation_sessions TO service_role;
ALTER TABLE public.impersonation_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admin_read_impersonation"
  ON public.impersonation_sessions
  FOR SELECT
  TO authenticated
  USING (public.is_super_admin());
CREATE INDEX IF NOT EXISTS idx_impersonation_actor ON public.impersonation_sessions(actor_user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_impersonation_target ON public.impersonation_sessions(target_user_id, started_at DESC);