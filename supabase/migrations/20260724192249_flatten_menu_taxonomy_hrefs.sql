-- Normalize legacy hierarchical taxonomy hrefs in menu_items to flat form.
-- Category/tag slugs are globally unique; the last path segment is canonical.
UPDATE public.menu_items
SET href = '/category/' || regexp_replace(href, '^.*/', '')
WHERE href ~ '^/category/[^/]+/.+';

UPDATE public.menu_items
SET href = '/tag/' || regexp_replace(href, '^.*/', '')
WHERE href ~ '^/tag/[^/]+/.+';
