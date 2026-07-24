-- Fix: /author/$slug 404 for anon and non-staff. The recent tightening of
-- `public.profiles` RLS removed anonymous SELECT; `profiles_public` had
-- `security_invoker=on`, so the view returned zero rows to anon/authenticated
-- non-staff and every expert hub 404-ed.
--
-- Solution: run the view with the owner's privileges (definer semantics) and
-- keep scoping via the view body (WHERE tenant_id = public_tenant_id()).
-- The projection already exposes only non-sensitive columns; PII stays behind
-- `profiles` RLS.
ALTER VIEW public.profiles_public SET (security_invoker = off, security_barrier = true);
GRANT SELECT ON public.profiles_public TO anon, authenticated;
