
-- 1) author_profiles: column-level SELECT for anon (exclude phone + media contacts)
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
     AND c.column_name = ANY (ARRAY['id', 'user_id', 'tenant_id', 'avatar_url', 'job_title', 'company', 'bio_pl', 'bio_en', 'contact_email', 'website_url', 'x_url', 'linkedin_url', 'facebook_url', 'instagram_url', 'spotify_url', 'custom_socials', 'is_public', 'created_at', 'updated_at', 'full_bio_pl', 'full_bio_en', 'org_functions', 'media_contact_name', 'layout_template_id', 'layout_overrides', 'counterpart_user_id', 'counterpart_lang', 'layout_preset', 'layout_section_order', 'brand_accent', 'brand_accent_dark']);
  IF v_cols IS NOT NULL THEN
    EXECUTE format('GRANT SELECT (%s) ON public.author_profiles TO anon', v_cols);
  END IF;
END $$;

-- 2) site_settings: split admin_email into a private row
INSERT INTO public.site_settings (tenant_id, key, value)
SELECT tenant_id, 'contact_private', jsonb_build_object('admin_email', value->>'admin_email')
FROM public.site_settings
WHERE key = 'general' AND value ? 'admin_email' AND (value->>'admin_email') <> ''
ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value;

UPDATE public.site_settings
SET value = (value - 'admin_email')
WHERE key = 'general' AND value ? 'admin_email';

-- Public read must exclude contact_private
DROP POLICY IF EXISTS "site_settings public read" ON public.site_settings;
CREATE POLICY "site_settings public read"
  ON public.site_settings
  FOR SELECT
  USING (tenant_id = public_tenant_id() AND key <> 'contact_private');

-- Admins of the tenant may read all settings (including contact_private)
DROP POLICY IF EXISTS "site_settings admin read" ON public.site_settings;
CREATE POLICY "site_settings admin read"
  ON public.site_settings
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
  );
