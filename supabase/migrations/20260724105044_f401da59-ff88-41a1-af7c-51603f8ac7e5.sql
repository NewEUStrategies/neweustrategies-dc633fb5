ALTER VIEW public.profiles_public SET (security_invoker = off, security_barrier = true);
GRANT SELECT ON public.profiles_public TO anon, authenticated;