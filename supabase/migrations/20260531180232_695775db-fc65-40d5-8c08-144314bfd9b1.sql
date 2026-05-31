
ALTER FUNCTION public.set_updated_at() SET search_path = public;

-- has_role: only callable from RLS (security definer) - revoke from public, grant authenticated for direct checks
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon;

-- handle_new_user is only called by trigger
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
