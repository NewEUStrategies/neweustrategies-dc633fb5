
-- 1) Add 'user' role for public readers
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'user';

-- 2) Extend profiles with personalization fields
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS cover_url text,
  ADD COLUMN IF NOT EXISTS prefs jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Allow users to insert their own profile (needed if trigger fails / for completeness)
DROP POLICY IF EXISTS "Users insert own profile" ON public.profiles;
CREATE POLICY "Users insert own profile" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- 3) Update handle_new_user: support 'reader' signups joining seed tenant with role 'user'
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_slug text;
  v_first_in_seed boolean;
  v_signup_type text;
  v_role app_role;
BEGIN
  v_signup_type := COALESCE(NEW.raw_user_meta_data->>'signup_type', 'staff');

  SELECT NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE tenant_id = (SELECT id FROM public.tenants WHERE slug='nes')
  ) INTO v_first_in_seed;

  IF v_signup_type = 'reader' THEN
    -- Public reader: join seed tenant as 'user'
    SELECT id INTO v_tenant_id FROM public.tenants WHERE slug='nes';
    v_role := 'user';
  ELSIF v_first_in_seed THEN
    SELECT id INTO v_tenant_id FROM public.tenants WHERE slug='nes';
    v_role := 'admin';
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
    v_role := 'admin';
  END IF;

  INSERT INTO public.profiles (id, email, display_name, tenant_id)
  VALUES (NEW.id, NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    v_tenant_id);

  INSERT INTO public.user_roles (user_id, role, tenant_id)
  VALUES (NEW.id, v_role, v_tenant_id);

  RETURN NEW;
END $function$;

-- Ensure trigger on auth.users is in place
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4) Bookmarks (saved posts/pages) - per user
CREATE TABLE IF NOT EXISTS public.user_bookmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tenant_id uuid NOT NULL DEFAULT current_tenant_id(),
  entity_type text NOT NULL CHECK (entity_type IN ('post','page')),
  entity_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, entity_type, entity_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_bookmarks TO authenticated;
GRANT ALL ON public.user_bookmarks TO service_role;

ALTER TABLE public.user_bookmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bookmarks owner select" ON public.user_bookmarks
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "bookmarks owner insert" ON public.user_bookmarks
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "bookmarks owner delete" ON public.user_bookmarks
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_user_bookmarks_user ON public.user_bookmarks(user_id, created_at DESC);

-- 5) Follows (authors / categories / tags) - per user
CREATE TABLE IF NOT EXISTS public.user_follows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tenant_id uuid NOT NULL DEFAULT current_tenant_id(),
  target_type text NOT NULL CHECK (target_type IN ('author','category','tag')),
  target_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, target_type, target_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_follows TO authenticated;
GRANT ALL ON public.user_follows TO service_role;

ALTER TABLE public.user_follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "follows owner select" ON public.user_follows
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "follows owner insert" ON public.user_follows
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "follows owner delete" ON public.user_follows
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_user_follows_user ON public.user_follows(user_id, created_at DESC);
