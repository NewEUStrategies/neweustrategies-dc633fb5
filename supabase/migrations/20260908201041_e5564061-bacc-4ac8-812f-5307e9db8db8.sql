UPDATE public.site_settings
SET value = jsonb_set(
  value,
  '{chrome,copyright_pl}',
  '"© {year} New European Strategies"'::jsonb,
  true
)
WHERE key = 'footer'
  AND value->'chrome'->>'copyright_pl' = '© {year} New European Strategies · Niezależny think-tank';

UPDATE public.site_settings
SET value = jsonb_set(
  value,
  '{chrome,copyright_en}',
  '"© {year} New European Strategies"'::jsonb,
  true
)
WHERE key = 'footer'
  AND value->'chrome'->>'copyright_en' = '© {year} New European Strategies · Independent think-tank';