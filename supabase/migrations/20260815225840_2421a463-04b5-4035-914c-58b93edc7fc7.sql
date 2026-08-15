UPDATE public.site_settings
SET value = jsonb_set(value, '{trending,variants,0,config,layoutStyle}', '"editorial"'::jsonb, true)
WHERE key = 'header';