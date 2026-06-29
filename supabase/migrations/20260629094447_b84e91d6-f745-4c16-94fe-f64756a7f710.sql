-- ============================================================
-- Profile Suite (LinkedIn-style): experiences, education, skills,
-- awards, hobbies, CV files, personality test (Big Five)
-- ============================================================

-- Helper: is the given user's profile publicly visible?
CREATE OR REPLACE FUNCTION public.profile_is_public(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND slug IS NOT NULL)
$$;

-- shared updated_at trigger fn already exists: public.set_updated_at

-- ----------------------------------------------------------------
-- 1. profile_experiences
-- ----------------------------------------------------------------
CREATE TABLE public.profile_experiences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_title text NOT NULL,
  company text,
  location text,
  start_date date,
  end_date date,
  is_current boolean NOT NULL DEFAULT false,
  description text,
  logo_url text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX profile_experiences_user_idx ON public.profile_experiences(user_id, sort_order);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_experiences TO authenticated;
GRANT SELECT ON public.profile_experiences TO anon;
GRANT ALL ON public.profile_experiences TO service_role;
ALTER TABLE public.profile_experiences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages own experiences" ON public.profile_experiences
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "public read for public profiles" ON public.profile_experiences
  FOR SELECT TO anon, authenticated USING (public.profile_is_public(user_id));
CREATE TRIGGER trg_profile_experiences_updated_at
  BEFORE UPDATE ON public.profile_experiences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------
-- 2. profile_education
-- ----------------------------------------------------------------
CREATE TABLE public.profile_education (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  school text NOT NULL,
  degree text,
  field text,
  start_date date,
  end_date date,
  description text,
  logo_url text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX profile_education_user_idx ON public.profile_education(user_id, sort_order);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_education TO authenticated;
GRANT SELECT ON public.profile_education TO anon;
GRANT ALL ON public.profile_education TO service_role;
ALTER TABLE public.profile_education ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages own education" ON public.profile_education
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "public read education" ON public.profile_education
  FOR SELECT TO anon, authenticated USING (public.profile_is_public(user_id));
CREATE TRIGGER trg_profile_education_updated_at
  BEFORE UPDATE ON public.profile_education
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------
-- 3. profile_skills
-- ----------------------------------------------------------------
CREATE TABLE public.profile_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL,
  level smallint NOT NULL DEFAULT 3 CHECK (level BETWEEN 1 AND 5),
  category text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX profile_skills_user_idx ON public.profile_skills(user_id, sort_order);
CREATE UNIQUE INDEX profile_skills_user_label_uniq ON public.profile_skills(user_id, lower(label));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_skills TO authenticated;
GRANT SELECT ON public.profile_skills TO anon;
GRANT ALL ON public.profile_skills TO service_role;
ALTER TABLE public.profile_skills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages own skills" ON public.profile_skills
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "public read skills" ON public.profile_skills
  FOR SELECT TO anon, authenticated USING (public.profile_is_public(user_id));
CREATE TRIGGER trg_profile_skills_updated_at
  BEFORE UPDATE ON public.profile_skills
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------
-- 4. profile_awards
-- ----------------------------------------------------------------
CREATE TABLE public.profile_awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  issuer text,
  awarded_at date,
  description text,
  icon text,
  url text,
  kind text NOT NULL DEFAULT 'award', -- 'award' | 'recognition' | 'mention'
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX profile_awards_user_idx ON public.profile_awards(user_id, kind, sort_order);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_awards TO authenticated;
GRANT SELECT ON public.profile_awards TO anon;
GRANT ALL ON public.profile_awards TO service_role;
ALTER TABLE public.profile_awards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages own awards" ON public.profile_awards
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "public read awards" ON public.profile_awards
  FOR SELECT TO anon, authenticated USING (public.profile_is_public(user_id));
CREATE TRIGGER trg_profile_awards_updated_at
  BEFORE UPDATE ON public.profile_awards
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------
-- 5. profile_hobbies
-- ----------------------------------------------------------------
CREATE TABLE public.profile_hobbies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL,
  icon text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX profile_hobbies_user_label_uniq ON public.profile_hobbies(user_id, lower(label));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_hobbies TO authenticated;
GRANT SELECT ON public.profile_hobbies TO anon;
GRANT ALL ON public.profile_hobbies TO service_role;
ALTER TABLE public.profile_hobbies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages own hobbies" ON public.profile_hobbies
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "public read hobbies" ON public.profile_hobbies
  FOR SELECT TO anon, authenticated USING (public.profile_is_public(user_id));
CREATE TRIGGER trg_profile_hobbies_updated_at
  BEFORE UPDATE ON public.profile_hobbies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------
-- 6. profile_cv_files
-- ----------------------------------------------------------------
CREATE TABLE public.profile_cv_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_url text NOT NULL,
  file_name text NOT NULL,
  mime_type text,
  size_bytes bigint NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  is_current boolean NOT NULL DEFAULT true,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX profile_cv_user_idx ON public.profile_cv_files(user_id, uploaded_at DESC);
CREATE UNIQUE INDEX profile_cv_user_current_uniq ON public.profile_cv_files(user_id) WHERE is_current;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_cv_files TO authenticated;
GRANT SELECT ON public.profile_cv_files TO anon;
GRANT ALL ON public.profile_cv_files TO service_role;
ALTER TABLE public.profile_cv_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages own cvs" ON public.profile_cv_files
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "public read current cv" ON public.profile_cv_files
  FOR SELECT TO anon, authenticated
  USING (is_current AND public.profile_is_public(user_id));
CREATE TRIGGER trg_profile_cv_updated_at
  BEFORE UPDATE ON public.profile_cv_files
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------
-- 7. personality_questions (global dictionary, Big Five)
-- ----------------------------------------------------------------
CREATE TABLE public.personality_questions (
  id integer PRIMARY KEY,
  axis text NOT NULL CHECK (axis IN ('openness','conscientiousness','extraversion','agreeableness','neuroticism')),
  reverse boolean NOT NULL DEFAULT false,
  text_pl text NOT NULL,
  text_en text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0
);
GRANT SELECT ON public.personality_questions TO anon, authenticated;
GRANT ALL ON public.personality_questions TO service_role;
ALTER TABLE public.personality_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read questions" ON public.personality_questions
  FOR SELECT TO anon, authenticated USING (true);

-- Seed: 30 items (6 per axis, 3 normal + 3 reverse)
INSERT INTO public.personality_questions (id, axis, reverse, text_pl, text_en, sort_order) VALUES
-- Openness
(1,  'openness',          false, 'Mam żywą wyobraźnię.',                              'I have a vivid imagination.',                       1),
(2,  'openness',          false, 'Lubię refleksje filozoficzne.',                     'I enjoy philosophical reflection.',                 2),
(3,  'openness',          false, 'Pociągają mnie nowe doświadczenia.',                'I am drawn to novel experiences.',                  3),
(4,  'openness',          true,  'Unikam abstrakcyjnych dyskusji.',                   'I avoid abstract discussions.',                     4),
(5,  'openness',          true,  'Wolę rutynę niż zmiany.',                           'I prefer routine over change.',                     5),
(6,  'openness',          true,  'Nie interesują mnie sztuki piękne.',                'Fine arts do not interest me.',                     6),
-- Conscientiousness
(7,  'conscientiousness', false, 'Dokańczam to, co zacznę.',                          'I finish what I start.',                            7),
(8,  'conscientiousness', false, 'Trzymam się planu.',                                'I stick to my plans.',                              8),
(9,  'conscientiousness', false, 'Dbam o porządek.',                                  'I keep things in order.',                           9),
(10, 'conscientiousness', true,  'Często odkładam zadania na później.',               'I often postpone tasks.',                          10),
(11, 'conscientiousness', true,  'Bywam niezorganizowany.',                           'I tend to be disorganized.',                       11),
(12, 'conscientiousness', true,  'Zapominam o obowiązkach.',                          'I forget my obligations.',                         12),
-- Extraversion
(13, 'extraversion',      false, 'Czuję się dobrze w grupach.',                       'I feel comfortable in groups.',                    13),
(14, 'extraversion',      false, 'Łatwo nawiązuję rozmowy.',                          'I start conversations easily.',                    14),
(15, 'extraversion',      false, 'Lubię być w centrum uwagi.',                        'I enjoy being the center of attention.',           15),
(16, 'extraversion',      true,  'Wolę spędzać czas sam.',                            'I prefer to spend time alone.',                    16),
(17, 'extraversion',      true,  'Niewiele mówię.',                                   'I do not talk much.',                              17),
(18, 'extraversion',      true,  'Krępuję się przy obcych.',                          'I feel awkward around strangers.',                 18),
-- Agreeableness
(19, 'agreeableness',     false, 'Współczuję innym.',                                 'I sympathize with others'' feelings.',             19),
(20, 'agreeableness',     false, 'Ufam ludziom.',                                     'I trust people.',                                  20),
(21, 'agreeableness',     false, 'Pomagam, gdy mogę.',                                'I help others when I can.',                        21),
(22, 'agreeableness',     true,  'Bywam szorstki w kontaktach.',                      'I can be harsh with people.',                      22),
(23, 'agreeableness',     true,  'Trudno mi wybaczać.',                               'I find it hard to forgive.',                       23),
(24, 'agreeableness',     true,  'Często krytykuję innych.',                          'I criticize others.',                              24),
-- Neuroticism
(25, 'neuroticism',       false, 'Często się martwię.',                               'I worry a lot.',                                   25),
(26, 'neuroticism',       false, 'Łatwo wpadam w stres.',                             'I get stressed easily.',                           26),
(27, 'neuroticism',       false, 'Bywam przygnębiony.',                               'I often feel down.',                               27),
(28, 'neuroticism',       true,  'Trudno mnie wyprowadzić z równowagi.',              'I am hard to upset.',                              28),
(29, 'neuroticism',       true,  'Radzę sobie ze stresem.',                           'I handle stress well.',                            29),
(30, 'neuroticism',       true,  'Rzadko bywam niespokojny.',                         'I rarely feel anxious.',                           30);

-- ----------------------------------------------------------------
-- 8. personality_results (one row per user, upsert on take)
-- ----------------------------------------------------------------
CREATE TABLE public.personality_results (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  openness smallint NOT NULL CHECK (openness BETWEEN 0 AND 100),
  conscientiousness smallint NOT NULL CHECK (conscientiousness BETWEEN 0 AND 100),
  extraversion smallint NOT NULL CHECK (extraversion BETWEEN 0 AND 100),
  agreeableness smallint NOT NULL CHECK (agreeableness BETWEEN 0 AND 100),
  neuroticism smallint NOT NULL CHECK (neuroticism BETWEEN 0 AND 100),
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  taken_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.personality_results TO authenticated;
GRANT SELECT ON public.personality_results TO anon;
GRANT ALL ON public.personality_results TO service_role;
ALTER TABLE public.personality_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages own personality" ON public.personality_results
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "public read personality" ON public.personality_results
  FOR SELECT TO anon, authenticated USING (public.profile_is_public(user_id));
CREATE TRIGGER trg_personality_results_updated_at
  BEFORE UPDATE ON public.personality_results
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
