
-- 1) Require explicit discoverable opt-in for the "public via slug" helper
CREATE OR REPLACE FUNCTION public.profile_is_public(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = _user_id
      AND slug IS NOT NULL
      AND discoverable = true
  )
$function$;

-- 2) author_profiles: revoke anon SELECT on sensitive contact columns.
--    Authenticated users retain access via existing policies; owners/admins
--    still see everything through the owner/admin policies.
REVOKE SELECT ON TABLE public.author_profiles FROM anon;

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
     AND c.column_name = ANY (ARRAY['id', 'user_id', 'tenant_id', 'avatar_url', 'job_title', 'company', 'bio_pl', 'bio_en', 'website_url', 'x_url', 'linkedin_url', 'facebook_url', 'instagram_url', 'spotify_url', 'custom_socials', 'is_public', 'created_at', 'updated_at', 'full_bio_pl', 'full_bio_en', 'org_functions', 'media_contact_name', 'layout_template_id', 'layout_overrides', 'counterpart_user_id', 'counterpart_lang', 'layout_preset', 'layout_section_order', 'brand_accent', 'brand_accent_dark']);
  IF v_cols IS NOT NULL THEN
    EXECUTE format('GRANT SELECT (%s) ON public.author_profiles TO anon', v_cols);
  END IF;
END $$;
