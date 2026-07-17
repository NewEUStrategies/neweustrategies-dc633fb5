// Loader helper: fetches admin/pages metadata (title/excerpt/SEO fields) for
// statically-coded routes such as /pricing, /contribute, /cookies. Content of
// these routes still lives in the React file - only the head() metadata is
// editable in /admin/pages.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type StaticPageSeo = {
  slug: string;
  title_pl: string | null;
  title_en: string | null;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  seo_title_pl: string | null;
  seo_title_en: string | null;
  seo_description_pl: string | null;
  seo_description_en: string | null;
  seo_canonical_url: string | null;
  seo_noindex: boolean | null;
  seo_og_image_url: string | null;
  og_image_generated_url: string | null;
} | null;

export function staticPageSeoQueryOptions(slug: string) {
  return queryOptions({
    queryKey: ["static-page-seo", slug],
    staleTime: 60_000,
    queryFn: async (): Promise<StaticPageSeo> => {
      const { data, error } = await supabase
        .from("pages")
        .select(
          "slug,title_pl,title_en,excerpt_pl,excerpt_en,seo_title_pl,seo_title_en,seo_description_pl,seo_description_en,seo_canonical_url,seo_noindex,seo_og_image_url,og_image_generated_url",
        )
        .eq("slug", slug)
        .eq("status", "published")
        .is("deleted_at", null)
        .maybeSingle();
      if (error) return null;
      return (data as StaticPageSeo) ?? null;
    },
  });
}

export function pickStaticSeo(
  row: StaticPageSeo,
  lang: "pl" | "en",
  fallback: { title: string; description: string },
): {
  title: string;
  description: string;
  canonical: string | null;
  noindex: boolean;
  image: string | null;
} {
  if (!row) {
    return {
      title: fallback.title,
      description: fallback.description,
      canonical: null,
      noindex: false,
      image: null,
    };
  }
  const seoTitle = lang === "en" ? row.seo_title_en : row.seo_title_pl;
  const baseTitle = lang === "en" ? row.title_en : row.title_pl;
  const seoDesc = lang === "en" ? row.seo_description_en : row.seo_description_pl;
  const baseDesc = lang === "en" ? row.excerpt_en : row.excerpt_pl;
  return {
    title: (seoTitle || baseTitle || fallback.title).trim(),
    description: (seoDesc || baseDesc || fallback.description).trim(),
    canonical: row.seo_canonical_url?.trim() || null,
    noindex: !!row.seo_noindex,
    image: row.seo_og_image_url?.trim() || row.og_image_generated_url?.trim() || null,
  };
}
