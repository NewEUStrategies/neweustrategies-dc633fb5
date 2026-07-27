UPDATE public.tenants
SET domain = 'neweuropeanstrategies.com',
    aliases = ARRAY['www.neweuropeanstrategies.com','neweustrategies.lovable.app','id-preview--59b9e533-d5b0-40cf-a791-624ceeb88e2e.lovable.app','localhost','127.0.0.1']
WHERE id = '07167e87-2e0f-42e8-ac5e-72445a2d4b0a';

UPDATE public.pages
SET builder_data = REPLACE(builder_data::text, 'neweustrategies.lovable.app', 'neweuropeanstrategies.com')::jsonb
WHERE builder_data::text ILIKE '%neweustrategies.lovable.app%';