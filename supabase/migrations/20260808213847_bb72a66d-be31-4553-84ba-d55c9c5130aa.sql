UPDATE public.site_settings
SET value = jsonb_set(
  value,
  '{items}',
  (
    SELECT jsonb_agg(
      CASE WHEN item->>'id' = 'clubs' THEN jsonb_set(item, '{icon}', '"landmark"'::jsonb) ELSE item END
      ORDER BY ord
    )
    FROM jsonb_array_elements(value->'items') WITH ORDINALITY AS t(item, ord)
  )
)
WHERE key = 'mobile_bottom_bar'
  AND value->'items' @> '[{"id":"clubs"}]'::jsonb;