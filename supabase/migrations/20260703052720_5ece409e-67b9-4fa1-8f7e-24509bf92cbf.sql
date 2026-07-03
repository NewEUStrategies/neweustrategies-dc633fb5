-- PR #37 migration 1/2: gate post/page body columns at PRIVILEGE layer
DO $$
DECLARE
  v_cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'posts'
     AND column_name NOT IN ('content_pl', 'content_en', 'builder_data', 'blocks_data');
  REVOKE SELECT ON public.posts FROM anon, authenticated;
  EXECUTE format('GRANT SELECT (%s) ON public.posts TO anon, authenticated', v_cols);

  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'pages'
     AND column_name NOT IN ('content_pl', 'content_en', 'builder_data');
  REVOKE SELECT ON public.pages FROM anon, authenticated;
  EXECUTE format('GRANT SELECT (%s) ON public.pages TO anon, authenticated', v_cols);
END $$;

-- PR #37 migration 2/2: enforce server-side newsletter DOI
DROP POLICY IF EXISTS "newsletter public subscribe" ON public.newsletter_subscribers;
REVOKE INSERT ON public.newsletter_subscribers FROM anon, authenticated;