
-- Restrict anon SELECT to non-sensitive columns only on profiles & author_profiles

-- 1) profiles: revoke full-column SELECT then grant only safe public columns to anon
REVOKE SELECT ON public.profiles FROM anon;
GRANT SELECT (
  id, tenant_id, slug, display_name, first_name, last_name,
  avatar_url, cover_url, bio, bio_pl, bio_en,
  job_title, current_company, specialization,
  linkedin_url, twitter_url, facebook_url, instagram_url, spotify_url, website_url,
  verified_at, created_at, updated_at, discoverable, profile_view_mode
) ON public.profiles TO anon;

-- 2) author_profiles: revoke full-column SELECT then grant only safe public columns to anon
REVOKE SELECT ON public.author_profiles FROM anon;
-- UWAGA (naprawa łańcucha migracji, ta sama klasa co REVOKE (answers) w
-- 20260713074738): ta lista zawiera kolumny author_profiles, których NIE tworzy
-- ŻADNA migracja w repo (layout_template_id, counterpart_user_id,
-- counterpart_lang - istnieją tylko na bazie produkcyjnej). Kolumnowy GRANT na
-- nieistniejącej kolumnie to 42703, który przerywa CAŁY `supabase db start`,
-- czyli job pgtap. Grant jedzie więc dynamicznie: PRZEZ te same kolumny, ale
-- tylko te, które w danej bazie faktycznie są. Na produkcji zestaw jest
-- kompletny, więc zachowanie nie zmienia się ani o jotę; na świeżej bazie
-- kolumn-widm nie ma czego udostępniać.
DO $$
DECLARE
  v_cols text;
BEGIN
  SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position)
    INTO v_cols
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND c.table_name = 'author_profiles'
     AND c.column_name = ANY (ARRAY['id', 'user_id', 'tenant_id', 'is_public', 'bio_pl', 'bio_en', 'full_bio_pl', 'full_bio_en', 'avatar_url', 'company', 'job_title', 'org_functions', 'brand_accent', 'brand_accent_dark', 'layout_preset', 'layout_template_id', 'layout_overrides', 'layout_section_order', 'linkedin_url', 'x_url', 'facebook_url', 'instagram_url', 'spotify_url', 'website_url', 'custom_socials', 'media_contact_name', 'created_at', 'updated_at', 'counterpart_user_id', 'counterpart_lang']);
  IF v_cols IS NOT NULL THEN
    EXECUTE format('GRANT SELECT (%s) ON public.author_profiles TO anon', v_cols);
  END IF;
END $$;
