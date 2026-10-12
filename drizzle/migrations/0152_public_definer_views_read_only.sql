-- Replay of supabase/migrations/20261012210000_public_definer_views_read_only.sql
-- (body identical to the repo file; rationale and measured production state live there).
-- Public DEFINER views become SELECT-only for anon/authenticated (writes through them
-- bypassed base-table RLS), content_access_public returns to security_invoker (no-op on
-- production), then the Supabase version is recorded in the ledger like 0149/0151.
-- ---------- 1) Widoki DEFINER: rolom klienckim zostaje SELECT ----------------
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

-- ---------- 2) content_access_public: z powrotem INVOKER, jak na produkcji ---
ALTER VIEW public.content_access_public SET (security_invoker = on);

INSERT INTO supabase_migrations.schema_migrations (version, statements, name, created_by)
SELECT '20261012210000', ARRAY[]::text[], '20261012210000_public_definer_views_read_only', 'lovable'
WHERE NOT EXISTS (
  SELECT 1 FROM supabase_migrations.schema_migrations sm WHERE sm.version = '20261012210000'
);
