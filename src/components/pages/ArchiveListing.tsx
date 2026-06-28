// Render listy opublikowanych dzieci (postów lub stron) dla
// template_type === 'archive_listing'. Używa public Data API z
// `posts.parent_page_id = parentPageId`.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PostListCard } from "@/components/molecules/PostListCard";

interface Props {
  parentPageId: string;
  lang: "pl" | "en";
  parentPath: string; // e.g. "blog" or "news/2024"
}

interface Row {
  id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  cover_image_url: string | null;
  published_at: string | null;
}

const L = {
  pl: { empty: "Brak opublikowanych wpisów w tej sekcji.", read: "Czytaj dalej" },
  en: { empty: "No published posts in this section yet.", read: "Read more" },
} as const;

export function ArchiveListing({ parentPageId, lang, parentPath }: Props) {
  const t = L[lang] ?? L.pl;
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["archive-listing", parentPageId] as const,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("posts")
        .select("id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at")
        .eq("status", "published")
        .is("deleted_at", null)
        .eq("parent_page_id", parentPageId)
        .order("published_at", { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    staleTime: 2 * 60_000,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground py-6">...</p>;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground py-6">{t.empty}</p>;

  return (
    <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-8 not-prose">
      {rows.map((r) => (
        <li key={r.id}>
          <PostListCard
            post={r}
            href={`/${parentPath}/${r.slug}`}
            lang={lang}
            link="app"
            imageZoom
            titleClassName="text-lg"
          />
        </li>
      ))}
    </ul>
  );
}
