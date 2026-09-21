-- Uzupełnij znany profil NES w oryginalnym widgecie stopki. Zachowaj wpisy redakcji.
UPDATE public.site_settings
SET value = jsonb_set(value,
  '{builder_data,sections,0,children,0,children,3,content,youtube}',
  to_jsonb('https://www.youtube.com/@NewEuropeanStrategies'::text)),
  updated_at = now()
WHERE key = 'footer'
  AND value #>> '{builder_data,sections,0,children,0,children,3,id}' = 'ftr-social'
  AND value #>> '{builder_data,sections,0,children,0,children,3,type}' = 'social-icons'
  AND coalesce(value #>> '{builder_data,sections,0,children,0,children,3,content,youtube}', '')
      !~ '^https?://[^/]+/[^/?#]';

UPDATE public.site_settings
SET value = jsonb_set(value,
  '{builder_data,sections,0,children,0,children,3,content,instagram}', to_jsonb('https://www.instagram.com/new.eustrategies/'::text)),
  updated_at = now()
WHERE key = 'footer'
  AND value #>> '{builder_data,sections,0,children,0,children,3,id}' = 'ftr-social'
  AND value #>> '{builder_data,sections,0,children,0,children,3,type}' = 'social-icons'
  AND coalesce(value #>> '{builder_data,sections,0,children,0,children,3,content,instagram}', '') = 'https://www.instagram.com/neweuropeanstrategies';

UPDATE public.site_settings
SET value = jsonb_set(value,
  '{builder_data,sections,0,children,0,children,3,content,linkedin}', to_jsonb('https://www.linkedin.com/company/new-european-strategies/'::text)),
  updated_at = now()
WHERE key = 'footer'
  AND value #>> '{builder_data,sections,0,children,0,children,3,id}' = 'ftr-social'
  AND value #>> '{builder_data,sections,0,children,0,children,3,type}' = 'social-icons'
  AND coalesce(value #>> '{builder_data,sections,0,children,0,children,3,content,linkedin}', '') = 'https://www.linkedin.com/company/new-european-strategies';

UPDATE public.site_settings
SET value = jsonb_set(value,
  '{builder_data,sections,0,children,0,children,3,content,spotify}', to_jsonb('https://open.spotify.com/show/7GuZqsCXg0qOb3rde1IhdN'::text)),
  updated_at = now()
WHERE key = 'footer'
  AND value #>> '{builder_data,sections,0,children,0,children,3,id}' = 'ftr-social'
  AND value #>> '{builder_data,sections,0,children,0,children,3,type}' = 'social-icons'
  AND coalesce(value #>> '{builder_data,sections,0,children,0,children,3,content,spotify}', '') = '';
