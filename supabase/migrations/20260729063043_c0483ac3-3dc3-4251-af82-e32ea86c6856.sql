DROP POLICY IF EXISTS "Users insert own profile" ON public.profiles;
CREATE POLICY "Users insert own profile"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (
  id = (SELECT auth.uid())
  AND tenant_id IS NOT NULL
  AND tenant_id = (SELECT COALESCE(public.current_tenant_id(), public.public_tenant_id()))
);