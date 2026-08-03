-- 1. Remove anon row-level read on profiles base table (full-row PII exposure).
DROP POLICY IF EXISTS "Profiles anon public authors" ON public.profiles;
REVOKE ALL ON public.profiles FROM anon;

-- 2. Pin search_path on remaining mutable-search_path functions.
ALTER FUNCTION public.accounting_metadata_minimum(jsonb) SET search_path = public, pg_temp;
ALTER FUNCTION public.accounting_retention_until(timestamp with time zone) SET search_path = public, pg_temp;
ALTER FUNCTION public.accounting_subject_ref(uuid) SET search_path = public, pg_temp;