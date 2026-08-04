-- Archiwizacja poprzedniego układu buildera dla /pricing (rewizja strony)
INSERT INTO public.content_revisions (tenant_id, entity_type, entity_id, snapshot, note)
SELECT p.tenant_id,
       'page',
       p.id,
       jsonb_build_object(
         'slug', p.slug,
         'title_pl', p.title_pl,
         'title_en', p.title_en,
         'builder_data', p.builder_data
       ),
       'Archiwum układu buildera przed przejęciem /pricing przez stronę renderowaną z kodu'
FROM public.pages p
WHERE p.slug = 'pricing'
  AND p.builder_data IS NOT NULL;

-- /pricing renderuje trasa React: czyścimy builder_data i porządkujemy metadane
UPDATE public.pages
SET builder_data = NULL,
    status = 'published',
    published_at = COALESCE(published_at, now()),
    title_pl = 'Cennik',
    title_en = 'Pricing',
    excerpt_pl = COALESCE(NULLIF(excerpt_pl, ''), 'Plany subskrypcji, segmenty odbiorców i porównanie korzyści.'),
    excerpt_en = COALESCE(NULLIF(excerpt_en, ''), 'Subscription plans, audience segments and a benefits comparison.'),
    updated_at = now()
WHERE slug = 'pricing';