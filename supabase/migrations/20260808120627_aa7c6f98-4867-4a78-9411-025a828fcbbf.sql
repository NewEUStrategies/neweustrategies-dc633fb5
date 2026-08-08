UPDATE public.site_settings
SET value = jsonb_set(
  value,
  '{items}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN item->>'id' = 'saved' AND NOT (value->'items' @> '[{"id":"clubs"}]'::jsonb) THEN jsonb_build_object(
          'id', 'clubs',
          'label_key', 'mobileBottomBar.itemLabels.clubs',
          'label_pl', '',
          'label_en', '',
          'icon', 'users-round',
          'href', '/club',
          'color', '#6d3fd4',
          'color_dark', '#b79bff',
          'badge', 'clubs',
          'enabled', true
        )
        WHEN item->>'id' = 'network' THEN jsonb_set(item, '{href}', '"/network"')
        WHEN item->>'id' = 'chats' THEN jsonb_set(item, '{href}', '"/messages"')
        WHEN item->>'id' = 'clubs' THEN jsonb_set(item, '{href}', '"/club"')
        WHEN item->>'id' = 'profile' THEN jsonb_set(item, '{href}', '"/profile"')
        WHEN item->>'id' = 'home' THEN jsonb_set(item, '{href}', '"/"')
        ELSE item
      END
      ORDER BY ord
    )
    FROM jsonb_array_elements(value->'items') WITH ORDINALITY AS t(item, ord)
  )
)
WHERE key = 'mobile_bottom_bar'
  AND jsonb_typeof(value->'items') = 'array';