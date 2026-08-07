INSERT INTO public.pages (
  tenant_id, slug, title_pl, title_en, excerpt_pl, excerpt_en,
  editor, status, published_at, template_type,
  seo_title_pl, seo_title_en, seo_description_pl, seo_description_en
)
SELECT DISTINCT
  p.tenant_id,
  'club',
  'Kluby dyskusyjne',
  'Discussion clubs',
  'Hub klubów dyskusyjnych: moje kluby, katalog klubów i aktywność. Dostęp dla planu pro i wyżej oraz osób zaproszonych.',
  'Discussion clubs hub: my clubs, club directory and activity. Available to pro plans and above, and to invited members.',
  'builder'::public.editor_type,
  'published'::public.post_status,
  now(),
  'default',
  'Kluby dyskusyjne - New European Strategies',
  'Discussion clubs - New European Strategies',
  'Zamknięte kluby dyskusyjne New European Strategies: wątki tematyczne, spotkania w regule Chatham House i katalog klubów.',
  'New European Strategies private discussion clubs: topical threads, Chatham House rule meetings and the club directory.'
FROM public.pages p
WHERE NOT EXISTS (
  SELECT 1 FROM public.pages e WHERE e.tenant_id = p.tenant_id AND e.slug = 'club'
);