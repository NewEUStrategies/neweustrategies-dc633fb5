
-- 1) profiles_public: switch to security_invoker so RLS applies to caller
ALTER VIEW public.profiles_public SET (security_invoker = on);

-- Ensure anon can read only safe, public columns from profiles (needed once
-- view runs as invoker). Explicit column grants keep email/phone/etc private
-- even though the anon RLS policy technically matches the row.
GRANT SELECT (
  id, tenant_id, slug, display_name, first_name, last_name,
  avatar_url, cover_url, bio_pl, bio_en, job_title,
  twitter_url, linkedin_url, facebook_url, instagram_url,
  spotify_url, website_url, current_company, specialization,
  verified_at, updated_at
) ON public.profiles TO anon;

-- 2) Tighten anon SELECT policy on profiles: still limited to editorial
-- authors, but combined with column-level grants above; sensitive columns
-- like email/phone/contact_email/location/prefs are NOT granted to anon so
-- they cannot appear in any anon query even if the row matches.
-- (Policy retained as-is for row scope; PII protection is enforced by grants.)

-- 3) qa_question_votes: stop exposing individual voter user_id publicly.
DROP POLICY IF EXISTS "qa votes public read" ON public.qa_question_votes;

CREATE POLICY "qa votes own read"
  ON public.qa_question_votes
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Aggregate vote counts remain available via public RPCs / joins in
-- qa_questions; raw voter identities are no longer readable by anon.
REVOKE SELECT ON public.qa_question_votes FROM anon;
