UPDATE site_settings
SET value = jsonb_set(
  jsonb_set(value, '{builder_data,sections,0,children,1,children,0,content,heightPx}', '64'::jsonb, true),
  '{builder_data,sections,0,children,1,children,0,content,widthPx}', '0'::jsonb, true)
WHERE key = 'header'
  AND value #>> '{builder_data,sections,0,children,1,children,0,type}' = 'image';