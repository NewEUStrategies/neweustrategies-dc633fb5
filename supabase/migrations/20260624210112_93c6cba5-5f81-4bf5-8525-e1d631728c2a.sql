UPDATE public.site_settings
SET value = (
  replace(
    replace(value::text,
      '/widgets/1780308199795-le062l.svg',
      '/theme/logo/1782319297295-zx9she.svg'
    ),
    '/widgets/1780308213022-72gmve.svg',
    '/theme/logo/1782319304300-bkjt7n.svg'
  )
)::jsonb
WHERE key = 'header';