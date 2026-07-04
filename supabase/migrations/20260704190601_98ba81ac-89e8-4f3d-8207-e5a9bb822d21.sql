
-- Restore column-level SELECT on private profile columns for authenticated role.
-- RLS already limits non-staff to their OWN row (id = auth.uid()) plus staff to
-- their tenant. Revoking column privileges also blocked users from reading their
-- own sensitive fields (first_name, last_name, phone, location, contact_email,
-- gender) - which broke Profile > Account load and save. Grant is safe because
-- RLS enforces the row scope.
GRANT SELECT (phone, contact_email, location, first_name, last_name, gender)
  ON public.profiles TO authenticated;

-- Make sure the table-level grants are present too (defensive - they should be,
-- but the query above only affects column-level ACL if table-level is missing).
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
-- anon keeps only the public-safe columns (implicit table-level SELECT for
-- the public.slug-based policy) - do NOT re-grant sensitive columns to anon.
