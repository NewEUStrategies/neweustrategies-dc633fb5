CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_phone text;
  v_job_title text;
  v_company text;
  v_linkedin text;
  v_website text;
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

  v_phone := nullif(trim(coalesce(NEW.raw_user_meta_data->>'phone', '')), '');
  v_job_title := nullif(trim(coalesce(
    NEW.raw_user_meta_data->>'position',
    NEW.raw_user_meta_data->>'job_title', '')), '');
  v_company := nullif(trim(coalesce(
    NEW.raw_user_meta_data->>'company',
    NEW.raw_user_meta_data->>'organization', '')), '');
  v_linkedin := nullif(trim(coalesce(
    NEW.raw_user_meta_data->>'linkedin',
    NEW.raw_user_meta_data->>'linkedin_url', '')), '');
  v_website := nullif(trim(coalesce(
    NEW.raw_user_meta_data->>'website',
    NEW.raw_user_meta_data->>'website_url', '')), '');

  v_slug_base := nullif(trim(concat_ws(' ', v_first_name, v_last_name)), '');
  IF v_slug_base IS NULL THEN
    v_slug_base := coalesce(v_display_name, split_part(NEW.email, '@', 1));
  END IF;
  v_slug := public.profiles_generate_unique_slug(v_slug_base);

  INSERT INTO public.profiles (
    id, email, display_name, first_name, last_name, slug, tenant_id,
    phone, job_title, current_company, linkedin_url, website_url
  )
  VALUES (
    NEW.id, NEW.email, v_display_name, v_first_name, v_last_name, v_slug, v_tenant_id,
    v_phone, v_job_title, v_company, v_linkedin, v_website
  );

  INSERT INTO public.user_roles (user_id, role, tenant_id)
  VALUES (NEW.id, v_role, v_tenant_id);

  RETURN NEW;
END;
$function$;