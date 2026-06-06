
-- Deduplicate media by filename within each tenant.
-- Keeper preference:
--   1) row referenced by any post.cover_image_url or page.cover_image_url
--   2) otherwise the oldest row (min created_at)
-- All other rows in the group are deleted. Storage objects are removed in a
-- follow-up step (storage API) using the returned paths.

WITH used AS (
  SELECT m.id
  FROM public.media m
  WHERE EXISTS (SELECT 1 FROM public.posts p WHERE p.cover_image_url = m.public_url)
     OR EXISTS (SELECT 1 FROM public.pages g WHERE g.cover_image_url = m.public_url)
),
ranked AS (
  SELECT
    m.id,
    m.tenant_id,
    m.filename,
    m.storage_path,
    ROW_NUMBER() OVER (
      PARTITION BY m.tenant_id, m.filename
      ORDER BY
        CASE WHEN u.id IS NOT NULL THEN 0 ELSE 1 END,
        m.created_at ASC,
        m.id ASC
    ) AS rn
  FROM public.media m
  LEFT JOIN used u ON u.id = m.id
),
to_delete AS (
  SELECT id, storage_path FROM ranked WHERE rn > 1
)
DELETE FROM public.media
WHERE id IN (SELECT id FROM to_delete);
