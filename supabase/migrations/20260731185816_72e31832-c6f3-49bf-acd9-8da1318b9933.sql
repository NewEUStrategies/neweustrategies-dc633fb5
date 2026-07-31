-- 1) Legacy backup table (0 rows, no policies) -> drop
DROP TABLE IF EXISTS public.suppressed_emails_legacy_backup;

-- 2) Scope admin profile update policy to authenticated only
DROP POLICY IF EXISTS "Admins can update tenant profiles" ON public.profiles;
CREATE POLICY "Admins can update tenant profiles"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (
    (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
    AND tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid())
  )
  WITH CHECK (
    (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
    AND tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid())
  );

-- 3) Ensure internal CRM identifier is never readable by clients
REVOKE ALL (crm_lead_id) ON public.speaker_profiles FROM anon, authenticated;

-- 4) Poll votes: writes only through the SECURITY DEFINER vote RPC
REVOKE INSERT, UPDATE, DELETE ON public.poll_votes FROM anon, authenticated;
