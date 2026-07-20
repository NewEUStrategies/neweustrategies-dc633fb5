// Zapytania publiczne serii/dossier (A8). RLS ogranicza przypięcia do
// opublikowanych wpisów tenanta hosta, więc czytelnik nigdy nie zobaczy
// szkicowych części cyklu. Hrefy jak w archiwach: page_full_path per parent.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface SeriesMeta {
  id: string;
  slug: string;
  name_pl: string;
  name_en: string;
  description_pl: string | null;
  description_en: string | null;
}

export interface SeriesPart {
  post_id: string;
  part_number: number;
  slug: string;
  title_pl: string;
  title_en: string;
  cover_image_url: string | null;
  published_at: string | null;
  href: string;
}

export interface PostSeriesInfo {
  series: SeriesMeta;
  /** Numer części bieżącego wpisu. */
  part: number;
  /** Wszystkie OPUBLIKOWANE części, rosnąco po part_number. */
  parts: SeriesPart[];
}

interface PartRowRaw {
  post_id: string;
  part_number: number;
  posts: {
    slug: string;
    title_pl: string;
    title_en: string;
    cover_image_url: string | null;
    published_at: string | null;
    parent_page_id: string;
  } | null;
}

async function hydratePartHrefs(rows: PartRowRaw[]): Promise<SeriesPart[]> {
  const present = rows.filter((r): r is PartRowRaw & { posts: NonNullable<PartRowRaw["posts"]> } =>
    Boolean(r.posts),
  );
  const parentIds = [...new Set(present.map((r) => r.posts.parent_page_id))];
  const paths = new Map<string, string>();
  await Promise.all(
    parentIds.map(async (pid) => {
      const { data } = await supabase.rpc("page_full_path", { _page_id: pid });
      if (typeof data === "string") paths.set(pid, data);
    }),
  );
  return present
    .map((r) => ({
      post_id: r.post_id,
      part_number: r.part_number,
      slug: r.posts.slug,
      title_pl: r.posts.title_pl,
      title_en: r.posts.title_en,
      cover_image_url: r.posts.cover_image_url,
      published_at: r.posts.published_at,
      href: `/${paths.get(r.posts.parent_page_id) ?? "blog"}/${r.posts.slug}`,
    }))
    .sort((a, b) => a.part_number - b.part_number);
}

async function fetchSeriesParts(seriesId: string): Promise<SeriesPart[]> {
  const { data, error } = await supabase
    .from("post_series")
    .select(
      "post_id, part_number, posts(slug, title_pl, title_en, cover_image_url, published_at, parent_page_id)",
    )
    .eq("series_id", seriesId)
    .order("part_number", { ascending: true });
  if (error) throw error;
  return hydratePartHrefs((data ?? []) as unknown as PartRowRaw[]);
}

/** Seria bieżącego wpisu (null = wpis nie należy do żadnej). */
export const postSeriesQueryOptions = (postId: string) =>
  queryOptions({
    queryKey: ["public", "post-series", postId] as const,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<PostSeriesInfo | null> => {
      const { data: link, error } = await supabase
        .from("post_series")
        .select("part_number, series(id, slug, name_pl, name_en, description_pl, description_en)")
        .eq("post_id", postId)
        .maybeSingle();
      if (error) throw error;
      const series = (link as { series?: SeriesMeta | null } | null)?.series ?? null;
      if (!link || !series) return null;
      const parts = await fetchSeriesParts(series.id);
      return { series, part: (link as { part_number: number }).part_number, parts };
    },
  });

/** Strona serii: meta + części. */
export const seriesPageQueryOptions = (slug: string) =>
  queryOptions({
    queryKey: ["public", "series-page", slug] as const,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<{ series: SeriesMeta; parts: SeriesPart[] } | null> => {
      const { data: series, error } = await supabase
        .from("series")
        .select("id, slug, name_pl, name_en, description_pl, description_en")
        .eq("slug", slug)
        .maybeSingle();
      if (error) throw error;
      if (!series) return null;
      const parts = await fetchSeriesParts(series.id);
      return { series: series as SeriesMeta, parts };
    },
  });
