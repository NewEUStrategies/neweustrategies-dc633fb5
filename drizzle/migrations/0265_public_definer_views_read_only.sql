
REVOKE ALL ON public.profiles_public FROM anon, authenticated;
GRANT SELECT ON public.profiles_public TO anon, authenticated;

REVOKE ALL ON public.career_page_sections_public FROM anon, authenticated;
GRANT SELECT ON public.career_page_sections_public TO anon, authenticated;

REVOKE ALL ON public.personality_results_public FROM anon, authenticated;
GRANT SELECT ON public.personality_results_public TO anon, authenticated;

REVOKE ALL ON public.profile_awards_public FROM anon, authenticated;
GRANT SELECT ON public.profile_awards_public TO anon, authenticated;

REVOKE ALL ON public.profile_education_public FROM anon, authenticated;
GRANT SELECT ON public.profile_education_public TO anon, authenticated;

REVOKE ALL ON public.profile_experiences_public FROM anon, authenticated;
GRANT SELECT ON public.profile_experiences_public TO anon, authenticated;

REVOKE ALL ON public.profile_hobbies_public FROM anon, authenticated;
GRANT SELECT ON public.profile_hobbies_public TO anon, authenticated;

REVOKE ALL ON public.profile_skills_public FROM anon, authenticated;
GRANT SELECT ON public.profile_skills_public TO anon, authenticated;

REVOKE ALL ON public.content_access_public FROM anon, authenticated;
GRANT SELECT ON public.content_access_public TO anon, authenticated;

ALTER VIEW public.content_access_public SET (security_invoker = on);
