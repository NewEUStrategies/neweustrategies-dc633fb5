
-- 1. TENANTS TABLE
CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.tenants TO authenticated;
GRANT ALL ON public.tenants TO service_role;

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER tenants_updated_at BEFORE UPDATE ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.tenants (slug, name) VALUES ('nes', 'New European Strategies');

-- 2. tenant_id COLUMNS
ALTER TABLE public.profiles    ADD COLUMN tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.posts       ADD COLUMN tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.categories  ADD COLUMN tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.tags        ADD COLUMN tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.media       ADD COLUMN tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.user_roles  ADD COLUMN tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;

UPDATE public.profiles   SET tenant_id = (SELECT id FROM public.tenants WHERE slug='nes') WHERE tenant_id IS NULL;
UPDATE public.posts      SET tenant_id = (SELECT id FROM public.tenants WHERE slug='nes') WHERE tenant_id IS NULL;
UPDATE public.categories SET tenant_id = (SELECT id FROM public.tenants WHERE slug='nes') WHERE tenant_id IS NULL;
UPDATE public.tags       SET tenant_id = (SELECT id FROM public.tenants WHERE slug='nes') WHERE tenant_id IS NULL;
UPDATE public.media      SET tenant_id = (SELECT id FROM public.tenants WHERE slug='nes') WHERE tenant_id IS NULL;
UPDATE public.user_roles SET tenant_id = (SELECT id FROM public.tenants WHERE slug='nes') WHERE tenant_id IS NULL;

ALTER TABLE public.profiles   ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.posts      ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.categories ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.tags       ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.media      ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.user_roles ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE public.posts      DROP CONSTRAINT IF EXISTS posts_slug_key;
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_slug_key;
ALTER TABLE public.tags       DROP CONSTRAINT IF EXISTS tags_slug_key;
CREATE UNIQUE INDEX IF NOT EXISTS posts_slug_per_tenant      ON public.posts (tenant_id, slug);
CREATE UNIQUE INDEX IF NOT EXISTS categories_slug_per_tenant ON public.categories (tenant_id, slug);
CREATE UNIQUE INDEX IF NOT EXISTS tags_slug_per_tenant       ON public.tags (tenant_id, slug);
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_role_key;
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_unique_per_tenant ON public.user_roles (tenant_id, user_id, role);

-- 3. HELPERS
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
$$;

-- Replace (do not drop) has_role to add tenant scoping
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.user_id = _user_id
      AND ur.role = _role
      AND ur.tenant_id = p.tenant_id
  )
$$;

-- 4. SIGNUP TRIGGER
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_slug text;
  v_first_in_seed boolean;
BEGIN
  SELECT NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE tenant_id = (SELECT id FROM public.tenants WHERE slug='nes')
  ) INTO v_first_in_seed;

  IF v_first_in_seed THEN
    SELECT id INTO v_tenant_id FROM public.tenants WHERE slug='nes';
  ELSE
    v_slug := lower(regexp_replace(
      coalesce(NEW.raw_user_meta_data->>'tenant_slug',
               split_part(NEW.email, '@', 2),
               split_part(NEW.email, '@', 1)),
      '[^a-z0-9]+', '-', 'g'));
    IF EXISTS (SELECT 1 FROM public.tenants WHERE slug = v_slug) THEN
      v_slug := v_slug || '-' || substr(NEW.id::text, 1, 8);
    END IF;
    INSERT INTO public.tenants (slug, name)
    VALUES (v_slug,
      coalesce(NEW.raw_user_meta_data->>'tenant_name',
               NEW.raw_user_meta_data->>'display_name',
               split_part(NEW.email, '@', 1)))
    RETURNING id INTO v_tenant_id;
  END IF;

  INSERT INTO public.profiles (id, email, display_name, tenant_id)
  VALUES (NEW.id, NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    v_tenant_id);

  INSERT INTO public.user_roles (user_id, role, tenant_id)
  VALUES (NEW.id, 'admin', v_tenant_id);

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 5. RLS REPLACEMENT (tenant scoping)

-- tenants
DROP POLICY IF EXISTS "Tenant members read own tenant" ON public.tenants;
CREATE POLICY "Tenant members read own tenant" ON public.tenants
  FOR SELECT TO authenticated USING (id = public.current_tenant_id());
DROP POLICY IF EXISTS "Admins update own tenant" ON public.tenants;
CREATE POLICY "Admins update own tenant" ON public.tenants
  FOR UPDATE TO authenticated
  USING (id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'));

-- posts
DROP POLICY IF EXISTS "Public reads published posts" ON public.posts;
DROP POLICY IF EXISTS "Staff reads all posts" ON public.posts;
DROP POLICY IF EXISTS "Authors insert own posts" ON public.posts;
DROP POLICY IF EXISTS "Authors update own; editors update any" ON public.posts;
DROP POLICY IF EXISTS "Editors delete posts" ON public.posts;
DROP POLICY IF EXISTS "Staff reads own tenant posts" ON public.posts;
DROP POLICY IF EXISTS "Authors insert own tenant posts" ON public.posts;
DROP POLICY IF EXISTS "Authors update own; editors update tenant posts" ON public.posts;
DROP POLICY IF EXISTS "Editors delete tenant posts" ON public.posts;

CREATE POLICY "Public reads published posts" ON public.posts
  FOR SELECT TO anon, authenticated USING (status = 'published');
CREATE POLICY "Staff reads own tenant posts" ON public.posts
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor') OR public.has_role(auth.uid(),'author')));
CREATE POLICY "Authors insert own tenant posts" ON public.posts
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND author_id = auth.uid()
              AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor') OR public.has_role(auth.uid(),'author')));
CREATE POLICY "Authors update tenant posts" ON public.posts
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor')
              OR (public.has_role(auth.uid(),'author') AND author_id = auth.uid())))
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "Editors delete tenant posts" ON public.posts
  FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor')));

-- categories
DROP POLICY IF EXISTS "Categories public read" ON public.categories;
DROP POLICY IF EXISTS "Editors manage categories" ON public.categories;
DROP POLICY IF EXISTS "Editors manage tenant categories" ON public.categories;
CREATE POLICY "Categories public read" ON public.categories
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Editors manage tenant categories" ON public.categories
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor')))
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor')));

-- tags
DROP POLICY IF EXISTS "Tags public read" ON public.tags;
DROP POLICY IF EXISTS "Authors manage tags" ON public.tags;
DROP POLICY IF EXISTS "Authors manage tenant tags" ON public.tags;
CREATE POLICY "Tags public read" ON public.tags
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Authors manage tenant tags" ON public.tags
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor') OR public.has_role(auth.uid(),'author')))
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor') OR public.has_role(auth.uid(),'author')));

-- media
DROP POLICY IF EXISTS "media public read" ON public.media;
DROP POLICY IF EXISTS "media staff delete" ON public.media;
DROP POLICY IF EXISTS "media staff insert" ON public.media;
DROP POLICY IF EXISTS "media staff update" ON public.media;
DROP POLICY IF EXISTS "media staff insert tenant" ON public.media;
DROP POLICY IF EXISTS "media staff update tenant" ON public.media;
DROP POLICY IF EXISTS "media staff delete tenant" ON public.media;
CREATE POLICY "media public read" ON public.media
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "media staff insert tenant" ON public.media
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor') OR public.has_role(auth.uid(),'author')));
CREATE POLICY "media staff update tenant" ON public.media
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor') OR uploader_id = auth.uid()));
CREATE POLICY "media staff delete tenant" ON public.media
  FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor') OR uploader_id = auth.uid()));

-- post_categories / post_tags
DROP POLICY IF EXISTS "post_categories public read" ON public.post_categories;
DROP POLICY IF EXISTS "post_categories staff manage" ON public.post_categories;
DROP POLICY IF EXISTS "post_categories staff manage tenant" ON public.post_categories;
CREATE POLICY "post_categories public read" ON public.post_categories
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "post_categories staff manage tenant" ON public.post_categories
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_id AND p.tenant_id = public.current_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_id AND p.tenant_id = public.current_tenant_id()));

DROP POLICY IF EXISTS "post_tags public read" ON public.post_tags;
DROP POLICY IF EXISTS "post_tags staff manage" ON public.post_tags;
DROP POLICY IF EXISTS "post_tags staff manage tenant" ON public.post_tags;
CREATE POLICY "post_tags public read" ON public.post_tags
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "post_tags staff manage tenant" ON public.post_tags
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_id AND p.tenant_id = public.current_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_id AND p.tenant_id = public.current_tenant_id()));

-- user_roles
DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins view all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users view own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins view tenant roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins manage tenant roles" ON public.user_roles;
CREATE POLICY "Users view own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins view tenant roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins manage tenant roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(),'admin'))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(),'admin'));

-- profiles: allow tenant members to see each other's profiles (for users page) + public read of authors
DROP POLICY IF EXISTS "Profiles readable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Profiles authors public read" ON public.profiles;
CREATE POLICY "Profiles public read" ON public.profiles
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- 6. STORAGE (media bucket) tenant-scoped
DROP POLICY IF EXISTS "media public read storage" ON storage.objects;
DROP POLICY IF EXISTS "media tenant upload storage" ON storage.objects;
DROP POLICY IF EXISTS "media tenant update storage" ON storage.objects;
DROP POLICY IF EXISTS "media tenant delete storage" ON storage.objects;
DROP POLICY IF EXISTS "Media bucket staff upload" ON storage.objects;
DROP POLICY IF EXISTS "Media bucket staff delete" ON storage.objects;
DROP POLICY IF EXISTS "Media bucket staff list" ON storage.objects;
DROP POLICY IF EXISTS "Media bucket public read" ON storage.objects;

CREATE POLICY "media public read storage" ON storage.objects
  FOR SELECT USING (bucket_id = 'media');
CREATE POLICY "media tenant upload storage" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media'
              AND (storage.foldername(name))[1] = public.current_tenant_id()::text);
CREATE POLICY "media tenant update storage" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'media'
         AND (storage.foldername(name))[1] = public.current_tenant_id()::text);
CREATE POLICY "media tenant delete storage" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'media'
         AND (storage.foldername(name))[1] = public.current_tenant_id()::text);
