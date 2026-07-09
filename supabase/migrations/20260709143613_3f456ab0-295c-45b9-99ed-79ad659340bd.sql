
CREATE TABLE public.author_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  avatar_url TEXT,
  job_title TEXT,
  company TEXT,
  bio_pl TEXT,
  bio_en TEXT,
  contact_email TEXT,
  phone TEXT,
  website_url TEXT,
  x_url TEXT,
  linkedin_url TEXT,
  facebook_url TEXT,
  instagram_url TEXT,
  spotify_url TEXT,
  custom_socials JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_public BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX author_profiles_tenant_idx ON public.author_profiles(tenant_id);
CREATE INDEX author_profiles_user_idx ON public.author_profiles(user_id);

GRANT SELECT ON public.author_profiles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.author_profiles TO authenticated;
GRANT ALL ON public.author_profiles TO service_role;

ALTER TABLE public.author_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view public author profiles"
  ON public.author_profiles FOR SELECT
  USING (is_public = true);

CREATE POLICY "Owners can view own author profile"
  ON public.author_profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Owners can insert own author profile"
  ON public.author_profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Owners can update own author profile"
  ON public.author_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Owners can delete own author profile"
  ON public.author_profiles FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage tenant author profiles"
  ON public.author_profiles FOR ALL
  TO authenticated
  USING (
    (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
    AND tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  )
  WITH CHECK (
    (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
    AND tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  );

CREATE TRIGGER update_author_profiles_updated_at
  BEFORE UPDATE ON public.author_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.author_profiles_set_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    SELECT tenant_id INTO NEW.tenant_id FROM public.profiles WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER author_profiles_set_tenant_trg
  BEFORE INSERT ON public.author_profiles
  FOR EACH ROW EXECUTE FUNCTION public.author_profiles_set_tenant();
