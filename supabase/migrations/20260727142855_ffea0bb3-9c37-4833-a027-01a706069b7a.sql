UPDATE public.site_settings
SET value = jsonb_set(
  value,
  '{builder_data,sections}',
  (
    SELECT jsonb_agg(
      CASE WHEN s->>'id' = 'ftr-main'
        THEN jsonb_set(s, '{layout,contentWidth}', '"full"'::jsonb, true)
        ELSE s
      END
    )
    FROM jsonb_array_elements(value->'builder_data'->'sections') s
  )
)
WHERE key = 'footer';