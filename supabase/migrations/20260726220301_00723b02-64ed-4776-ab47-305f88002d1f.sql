UPDATE public.pages
SET builder_data = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(
        builder_data,
        '{sections,0,children,0,children,0,content}',
        '{"align":"center","size":"sm","html_pl":"<span style=\"color:#f57c1f;font-weight:600;letter-spacing:.08em;text-transform:uppercase;\">Dołącz do</span>","html_en":"<span style=\"color:#f57c1f;font-weight:600;letter-spacing:.08em;text-transform:uppercase;\">Join our</span>"}'::jsonb
      ),
      '{sections,0,children,0,children,1,content}',
      '{"tag":"h1","align":"center","sizePreset":"display","variant":"gradient","text_pl":"newslettera","text_en":"newsletter"}'::jsonb
    ),
    '{sections,1,children,0,children,0,content}',
    '{"tag":"h2","align":"left","sizePreset":"xl","variant":"default","text_pl":"Strategiczne myślenie, nowe perspektywy","text_en":"Strategic thinking, new perspectives"}'::jsonb
  ),
  '{sections,1,children,0,children,1,content}',
  '{"align":"left","size":"lg","html_pl":"Śledź globalną i europejską grę mocarstw z pierwszego rzędu.","html_en":"Follow the global and European power game from the front row."}'::jsonb
),
updated_at = now()
WHERE slug = 'dolacz-do-newslettera';