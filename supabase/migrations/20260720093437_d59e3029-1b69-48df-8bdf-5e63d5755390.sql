-- Fix SECURITY DEFINER view lint: force security_invoker so RLS applies as querying user.
ALTER VIEW public.profiles_public SET (security_invoker = on);
ALTER VIEW public.content_access_public SET (security_invoker = on);

-- Add tenant scoping to user_pending_counters own SELECT policy for consistency
-- with tenant isolation invariant across owner-scoped policies.
DROP POLICY IF EXISTS user_pending_counters_own_select ON public.user_pending_counters;
CREATE POLICY user_pending_counters_own_select
  ON public.user_pending_counters
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() AND tenant_id = public.public_tenant_id());