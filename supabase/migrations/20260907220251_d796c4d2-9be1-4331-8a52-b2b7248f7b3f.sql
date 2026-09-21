UPDATE site_settings
SET value = jsonb_set(
  value,
  '{builder_data,sections,0,children,2,children}',
  (
    SELECT jsonb_agg(
      elem ORDER BY
        CASE elem->>'type'
          WHEN 'account-link' THEN 0
          WHEN 'theme-toggle' THEN 1
          WHEN 'lang-switcher' THEN 2
          ELSE 3
        END,
        ord
    )
    FROM jsonb_array_elements(
      value->'builder_data'->'sections'->0->'children'->2->'children'
    ) WITH ORDINALITY AS t(elem, ord)
  )
)
WHERE key = 'header'
  AND value #>> '{builder_data,sections,0,children,2,children,0,type}' IS NOT NULL;