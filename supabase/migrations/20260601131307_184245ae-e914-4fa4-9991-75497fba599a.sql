-- Delete imported pages that only contain a title (no real content extractable from WP)
DELETE FROM public.pages
WHERE tenant_id = '07167e87-2e0f-42e8-ac5e-72445a2d4b0a'
  AND builder_data IS NOT NULL
  AND slug NOT IN ('blog')
  AND (
    SELECT COALESCE(SUM(jsonb_array_length(c->'children')), 0)
    FROM jsonb_array_elements(builder_data->'sections') s,
         jsonb_array_elements(s->'children') c
  ) <= 1;