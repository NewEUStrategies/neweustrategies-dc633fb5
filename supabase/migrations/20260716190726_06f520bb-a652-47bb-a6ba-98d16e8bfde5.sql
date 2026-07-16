
INSERT INTO public.categories (slug, name_pl, name_en, description_pl, description_en, tenant_id)
SELECT 'policy-papers', 'Policy Papers', 'Policy Papers',
       'Analizy strategiczne i policy papers.', 'Strategic analyses and policy papers.',
       (SELECT tenant_id FROM public.categories WHERE tenant_id IS NOT NULL GROUP BY tenant_id ORDER BY count(*) DESC LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM public.categories WHERE slug = 'policy-papers');

UPDATE public.menu_items
SET href = '/category/policy-papers'
WHERE href = '/policy-papers';
