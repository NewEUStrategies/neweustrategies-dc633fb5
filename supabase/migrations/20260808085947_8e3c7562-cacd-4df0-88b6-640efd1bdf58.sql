UPDATE public.site_settings
SET value = jsonb_set(coalesce(value,'{}'::jsonb), '{clubs_enabled}', 'true'::jsonb, true)
WHERE key = 'community_modules';

INSERT INTO public.site_settings (tenant_id, key, value)
SELECT t.id, 'community_modules', '{"clubs_enabled": true}'::jsonb
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.site_settings s
  WHERE s.tenant_id = t.id AND s.key = 'community_modules'
);