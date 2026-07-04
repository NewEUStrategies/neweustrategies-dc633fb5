-- Helper: generate unique slug from a base string for public.profiles
CREATE OR REPLACE FUNCTION public.profiles_generate_unique_slug(_base text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_base text;
  v_candidate text;
  v_suffix int := 1;
BEGIN
  v_base := lower(regexp_replace(unaccent(coalesce(_base, '')), '[^a-z0-9]+', '-', 'g'));
  v_base := regexp_replace(v_base, '(^-+|-+$)', '', 'g');
  v_base := regexp_replace(v_base, '-{2,}', '-', 'g');

  IF v_base IS NULL OR length(v_base) < 2 THEN
    v_base := 'user-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);
  END IF;

  IF length(v_base) > 60 THEN
    v_base := substr(v_base, 1, 60);
    v_base := regexp_replace(v_base, '-+$', '', 'g');
  END IF;

  v_candidate := v_base;
  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE slug = v_candidate) LOOP
    v_suffix := v_suffix + 1;
    v_candidate := v_base || '-' || v_suffix::text;
    IF v_suffix > 10000 THEN
      v_candidate := v_base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
      EXIT;
    END IF;
  END LOOP;

  RETURN v_candidate;
END;
$$;

-- Update handle_new_user to auto-assign a unique slug + first/last name
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_default_tenant uuid;
  v_tenant_id uuid;
  v_tenant_slug text;
  v_first_in_default boolean;
  v_app_signup text;
  v_user_signup text;
  v_role app_role;
  v_first_name text;
  v_last_name text;
  v_display_name text;
  v_slug_base text;
  v_slug text;
BEGIN
  v_app_signup  := NEW.raw_app_meta_data->>'signup_type';
  v_user_signup := NEW.raw_user_meta_data->>'signup_type';

  SELECT COALESCE(
    (SELECT id FROM public.tenants WHERE is_default LIMIT 1),
    (SELECT id FROM public.tenants WHERE slug = 'nes' LIMIT 1)
  ) INTO v_default_tenant;
  IF v_default_tenant IS NULL THEN
    RAISE EXCEPTION 'handle_new_user: no default tenant configured';
  END IF;

  SELECT NOT EXISTS (SELECT 1 FROM public.profiles WHERE tenant_id = v_default_tenant)
    INTO v_first_in_default;

  IF COALESCE(v_app_signup, v_user_signup) = 'reader' THEN
    v_tenant_id := v_default_tenant;
    v_role := 'user';
  ELSIF v_app_signup = 'staff' THEN
    v_tenant_slug := lower(regexp_replace(
      coalesce(NEW.raw_app_meta_data->>'tenant_slug',
               NEW.raw_user_meta_data->>'tenant_slug',
               split_part(NEW.email, '@', 2),
               split_part(NEW.email, '@', 1)),
      '[^a-z0-9]+', '-', 'g'));
    IF EXISTS (SELECT 1 FROM public.tenants WHERE slug = v_tenant_slug) THEN
      v_tenant_slug := v_tenant_slug || '-' || substr(NEW.id::text, 1, 8);
    END IF;
    INSERT INTO public.tenants (slug, name)
    VALUES (v_tenant_slug,
      coalesce(NEW.raw_app_meta_data->>'tenant_name',
               NEW.raw_user_meta_data->>'tenant_name',
               NEW.raw_user_meta_data->>'display_name',
               split_part(NEW.email, '@', 1)))
    RETURNING id INTO v_tenant_id;
    v_role := 'admin';
  ELSIF v_first_in_default THEN
    v_tenant_id := v_default_tenant;
    v_role := 'admin';
  ELSE
    v_tenant_id := v_default_tenant;
    v_role := 'user';
  END IF;

  -- Derive first/last/display name from OAuth metadata when available
  v_first_name := nullif(trim(coalesce(
    NEW.raw_user_meta_data->>'first_name',
    NEW.raw_user_meta_data->>'given_name',
    split_part(coalesce(NEW.raw_user_meta_data->>'full_name',
                        NEW.raw_user_meta_data->>'name', ''), ' ', 1)
  )), '');

  v_last_name := nullif(trim(coalesce(
    NEW.raw_user_meta_data->>'last_name',
    NEW.raw_user_meta_data->>'family_name',
    nullif(substring(coalesce(NEW.raw_user_meta_data->>'full_name',
                              NEW.raw_user_meta_data->>'name', '')
                     FROM position(' ' IN coalesce(NEW.raw_user_meta_data->>'full_name',
                                                    NEW.raw_user_meta_data->>'name', '')) + 1), '')
  )), '');

  v_display_name := coalesce(
    NEW.raw_user_meta_data->>'display_name',
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    nullif(trim(concat_ws(' ', v_first_name, v_last_name)), ''),
    split_part(NEW.email, '@', 1)
  );

  -- Build slug base from first+last name, then display name, then email local
  v_slug_base := nullif(trim(concat_ws(' ', v_first_name, v_last_name)), '');
  IF v_slug_base IS NULL THEN
    v_slug_base := coalesce(v_display_name, split_part(NEW.email, '@', 1));
  END IF;
  v_slug := public.profiles_generate_unique_slug(v_slug_base);

  INSERT INTO public.profiles (id, email, display_name, first_name, last_name, slug, tenant_id)
  VALUES (NEW.id, NEW.email, v_display_name, v_first_name, v_last_name, v_slug, v_tenant_id);

  INSERT INTO public.user_roles (user_id, role, tenant_id)
  VALUES (NEW.id, v_role, v_tenant_id);

  RETURN NEW;
END;
$$;

-- Backfill: assign unique slug to existing profiles that don't have one
DO $$
DECLARE
  r record;
  v_base text;
  v_new_slug text;
BEGIN
  FOR r IN
    SELECT id, email, display_name, first_name, last_name
      FROM public.profiles
     WHERE slug IS NULL OR length(trim(slug)) = 0
     ORDER BY created_at NULLS LAST
  LOOP
    v_base := nullif(trim(concat_ws(' ', r.first_name, r.last_name)), '');
    IF v_base IS NULL THEN
      v_base := coalesce(nullif(trim(r.display_name), ''), split_part(coalesce(r.email, ''), '@', 1));
    END IF;
    v_new_slug := public.profiles_generate_unique_slug(v_base);
    UPDATE public.profiles SET slug = v_new_slug WHERE id = r.id;
  END LOOP;
END $$;