
-- 1) content_access.password_hash: revoke from anon so it's never returned by
-- PostgREST to unauthenticated readers. Verification still works via the
-- SECURITY DEFINER verify_content_password RPC.
REVOKE SELECT (password_hash) ON public.content_access FROM anon;
REVOKE SELECT (password_hash) ON public.content_access FROM PUBLIC;

-- 2) profiles: hide sensitive contact fields from anonymous readers. The
-- "Profiles anon public authors" RLS policy still lets anon see editorial
-- rows, but PostgREST will now reject any anon SELECT that projects these
-- columns, and safe columns (display_name, avatar, bios, social links) stay
-- readable for bylines.
REVOKE SELECT (phone) ON public.profiles FROM anon;
REVOKE SELECT (contact_email) ON public.profiles FROM anon;

-- 3) Function search_path hardening.
ALTER FUNCTION public.jsonb_append_distinct(jsonb, text, text)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.web_vitals_daily_p75(timestamp with time zone, uuid)
  SET search_path = public, pg_temp;
