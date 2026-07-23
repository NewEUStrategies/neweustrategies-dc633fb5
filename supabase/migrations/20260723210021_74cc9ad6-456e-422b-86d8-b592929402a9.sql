GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_experiences TO authenticated;
GRANT ALL ON public.profile_experiences TO service_role;
GRANT SELECT ON public.profile_experiences TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_education TO authenticated;
GRANT ALL ON public.profile_education TO service_role;
GRANT SELECT ON public.profile_education TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_skills TO authenticated;
GRANT ALL ON public.profile_skills TO service_role;
GRANT SELECT ON public.profile_skills TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_awards TO authenticated;
GRANT ALL ON public.profile_awards TO service_role;
GRANT SELECT ON public.profile_awards TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_hobbies TO authenticated;
GRANT ALL ON public.profile_hobbies TO service_role;
GRANT SELECT ON public.profile_hobbies TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_cv_files TO authenticated;
GRANT ALL ON public.profile_cv_files TO service_role;
GRANT SELECT ON public.profile_cv_files TO anon;

DROP POLICY IF EXISTS "owner manages own experiences" ON public.profile_experiences;
CREATE POLICY "owner manages own experiences"
ON public.profile_experiences
FOR ALL
TO authenticated
USING (auth.uid() = user_id AND tenant_id = public.current_tenant_id())
WITH CHECK (auth.uid() = user_id AND tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "owner manages own education" ON public.profile_education;
CREATE POLICY "owner manages own education"
ON public.profile_education
FOR ALL
TO authenticated
USING (auth.uid() = user_id AND tenant_id = public.current_tenant_id())
WITH CHECK (auth.uid() = user_id AND tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "owner manages own skills" ON public.profile_skills;
CREATE POLICY "owner manages own skills"
ON public.profile_skills
FOR ALL
TO authenticated
USING (auth.uid() = user_id AND tenant_id = public.current_tenant_id())
WITH CHECK (auth.uid() = user_id AND tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "owner manages own awards" ON public.profile_awards;
CREATE POLICY "owner manages own awards"
ON public.profile_awards
FOR ALL
TO authenticated
USING (auth.uid() = user_id AND tenant_id = public.current_tenant_id())
WITH CHECK (auth.uid() = user_id AND tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "owner manages own hobbies" ON public.profile_hobbies;
CREATE POLICY "owner manages own hobbies"
ON public.profile_hobbies
FOR ALL
TO authenticated
USING (auth.uid() = user_id AND tenant_id = public.current_tenant_id())
WITH CHECK (auth.uid() = user_id AND tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "owner manages own cvs" ON public.profile_cv_files;
CREATE POLICY "owner manages own cvs"
ON public.profile_cv_files
FOR ALL
TO authenticated
USING (auth.uid() = user_id AND tenant_id = public.current_tenant_id())
WITH CHECK (auth.uid() = user_id AND tenant_id = public.current_tenant_id());