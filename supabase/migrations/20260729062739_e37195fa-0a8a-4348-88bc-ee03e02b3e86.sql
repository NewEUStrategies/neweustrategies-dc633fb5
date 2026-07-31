-- 1) profiles: prevent self-assignment to arbitrary tenant
DROP POLICY IF EXISTS "Users insert own profile" ON public.profiles;
CREATE POLICY "Users insert own profile"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = id
  AND tenant_id IS NOT NULL
  AND tenant_id = COALESCE(public.current_tenant_id(), public.public_tenant_id())
);

-- 2) author_profiles: scoped public read (safe columns only for anon)
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
     AND c.column_name = ANY (ARRAY['id', 'user_id', 'tenant_id', 'avatar_url', 'job_title', 'company', 'bio_pl', 'bio_en', 'full_bio_pl', 'full_bio_en', 'org_functions', 'website_url', 'x_url', 'linkedin_url', 'facebook_url', 'instagram_url', 'spotify_url', 'custom_socials', 'is_public', 'created_at', 'updated_at', 'layout_template_id', 'layout_overrides', 'counterpart_user_id', 'counterpart_lang', 'layout_preset', 'layout_section_order', 'brand_accent', 'brand_accent_dark']);
  IF v_cols IS NOT NULL THEN
    EXECUTE format('GRANT SELECT (%s) ON public.author_profiles TO anon', v_cols);
  END IF;
END $$;

DROP POLICY IF EXISTS "Public can view public author profiles" ON public.author_profiles;
CREATE POLICY "Public can view public author profiles"
ON public.author_profiles
FOR SELECT
TO anon
USING (is_public = true AND tenant_id = public.public_tenant_id());

DROP POLICY IF EXISTS "Authenticated can view public author profiles" ON public.author_profiles;
CREATE POLICY "Authenticated can view public author profiles"
ON public.author_profiles
FOR SELECT
TO authenticated
USING (is_public = true AND tenant_id = COALESCE(public.current_tenant_id(), public.public_tenant_id()));

-- 3) fixed search_path on email queue helper functions
ALTER FUNCTION public.enqueue_email(queue_name text, payload jsonb) SET search_path = public, pgmq, extensions;
ALTER FUNCTION public.read_email_batch(queue_name text, batch_size integer, vt integer) SET search_path = public, pgmq, extensions;
ALTER FUNCTION public.delete_email(queue_name text, message_id bigint) SET search_path = public, pgmq, extensions;
ALTER FUNCTION public.move_to_dlq(source_queue text, dlq_name text, message_id bigint, payload jsonb) SET search_path = public, pgmq, extensions;