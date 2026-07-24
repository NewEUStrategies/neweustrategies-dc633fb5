-- Referencje wpisow dla widgetow buildera (slider manualny, karty wpisow):
-- wpis + publiczny profil autora JEDNYM wywolaniem. Wczesniej kazdy referowany
-- wpis kosztowal dwa SEKWENCYJNE round-tripy HTTP (posts -> profiles), a
-- slider manualny generowal te pare NA KAZDY slajd.
--
-- SECURITY INVOKER: RLS na posts obowiazuje (anon widzi tylko opublikowane
-- wpisy swojego tenanta), a autor jest czytany przez definer-owski widok
-- profiles_public - dokladnie ta sama publiczna projekcja, ktora konsumuje
-- cala powierzchnia publiczna. Kolumny odwzorowuja selecty z
-- src/lib/builder/contentRefs.ts.

CREATE OR REPLACE FUNCTION public.get_post_refs(_post_ids uuid[])
RETURNS TABLE(
  id uuid,
  slug text,
  title_pl text,
  title_en text,
  excerpt_pl text,
  excerpt_en text,
  cover_image_url text,
  published_at timestamptz,
  author_id uuid,
  author_name text,
  author_avatar text,
  author_slug text
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p.id,
         p.slug,
         p.title_pl,
         p.title_en,
         p.excerpt_pl,
         p.excerpt_en,
         p.cover_image_url,
         p.published_at,
         p.author_id,
         pp.display_name AS author_name,
         pp.avatar_url AS author_avatar,
         pp.slug AS author_slug
    FROM public.posts p
    LEFT JOIN public.profiles_public pp ON pp.id = p.author_id
    WHERE p.id = ANY (_post_ids);
$$;

GRANT EXECUTE ON FUNCTION public.get_post_refs(uuid[]) TO anon, authenticated, service_role;
