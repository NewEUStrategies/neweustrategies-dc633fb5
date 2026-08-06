UPDATE public.site_settings
SET value = jsonb_set(
  value,
  '{items}',
  (
    SELECT jsonb_agg(
      CASE WHEN item->>'id' = 'home'
        THEN item || jsonb_build_object('color', '#fa9346', 'color_dark', '#fa9346')
        ELSE item END
      ORDER BY ord
    )
    FROM jsonb_array_elements(value->'items') WITH ORDINALITY AS t(item, ord)
  )
)
WHERE key = 'mobile_bottom_bar' AND value ? 'items';