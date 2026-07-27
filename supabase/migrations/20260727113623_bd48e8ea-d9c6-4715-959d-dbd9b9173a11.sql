UPDATE public.site_settings
SET value = jsonb_set(
  value,
  '{builder_data,sections,0,children,0,children,2,style}',
  COALESCE(value #> '{builder_data,sections,0,children,0,children,2,style}', '{}'::jsonb)
    || '{"align":{"desktop":"left","tablet":"left","mobile":"left"},"selfJustify":"start"}'::jsonb,
  true
),
updated_at = now()
WHERE key = 'footer'
  AND value #>> '{builder_data,sections,0,children,0,children,2,id}' = 'ftr-contact';