-- Remove previously imported WordPress pages (keep originals: blog + 2 placeholders without builder_data)
DELETE FROM public.post_categories WHERE post_id IN (
  SELECT id FROM public.posts
  WHERE tenant_id = '07167e87-2e0f-42e8-ac5e-72445a2d4b0a' AND builder_data IS NOT NULL
);
DELETE FROM public.post_tags WHERE post_id IN (
  SELECT id FROM public.posts
  WHERE tenant_id = '07167e87-2e0f-42e8-ac5e-72445a2d4b0a' AND builder_data IS NOT NULL
);
DELETE FROM public.posts
WHERE tenant_id = '07167e87-2e0f-42e8-ac5e-72445a2d4b0a'
  AND builder_data IS NOT NULL;

DELETE FROM public.pages
WHERE tenant_id = '07167e87-2e0f-42e8-ac5e-72445a2d4b0a'
  AND builder_data IS NOT NULL
  AND slug NOT IN ('blog', 'page-mpu5y8vn', 'page-mpu5y8wg');