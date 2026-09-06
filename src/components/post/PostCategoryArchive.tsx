// Mini-archiwum kategorii pod treścią wpisu.
//
// Wygląd NIE jest osobną konfiguracją: sekcja czyta dokładnie te same globalne
// ustawienia co strona archiwum kategorii (Panel -> Wygląd -> Archiwum
// kategorii) - `archiveLayoutQueryOptions("category")` - i renderuje listę tym
// samym komponentem `ArchivePosts`, więc kolumny / styl listy (grid, lista,
// masonry) są spójne z archiwum. Liczba kart jest przycięta do jednego "rzędu
// x2", żeby stopka wpisu nie zamieniła się w pełne archiwum.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "@/lib/lucide-shim";
import { ArchivePosts } from "@/components/archive/layouts/ArchivePosts";
import { archiveLayoutQueryOptions } from "@/lib/archive-layout-settings";
import { taxonomyArchiveQueryOptions } from "@/lib/queries/archives";

export interface PostCategoryArchiveProps {
  /** Kategoria główna wpisu (pierwsza z listy kategorii). */
  category: { slug: string; name_pl: string; name_en: string };
  /** Wpis, na którym stoimy - wykluczany z listy. */
  currentPostId: string;
  lang: "pl" | "en";
  className?: string;
}

/** Maksymalna liczba kart: dwa rzędy siatki archiwum. */
export function archiveCardLimit(columns: number): number {
  return Math.max(2, Math.min(8, columns * 2));
}

export function PostCategoryArchive({
  category,
  currentPostId,
  lang,
  className,
}: PostCategoryArchiveProps) {
  const { data: settings } = useQuery(archiveLayoutQueryOptions("category"));
  const limit = archiveCardLimit(settings?.columns ?? 3);
  const { data } = useQuery({
    ...taxonomyArchiveQueryOptions("category", category.slug, {
      page: 1,
      pageSize: limit + 1,
    }),
    enabled: Boolean(settings),
  });

  if (!settings) return null;
  const posts = (data?.posts ?? []).filter((p) => p.id !== currentPostId).slice(0, limit);
  if (posts.length === 0) return null;

  const name = lang === "en" ? category.name_en : category.name_pl;
  const heading = lang === "en" ? `More in ${name}` : `Więcej w kategorii ${name}`;
  const allLabel = lang === "en" ? "See the whole archive" : "Zobacz całe archiwum";

  return (
    <section className={className} aria-label={heading}>
      <div className="mb-4 flex items-end justify-between gap-4">
        <h2 className="text-xl font-semibold tracking-tight">{heading}</h2>
        <Link
          to="/category/$slug"
          params={{ slug: category.slug }}
          className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          {allLabel}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
      <ArchivePosts posts={posts} lang={lang} settings={settings} emptyText="" />
    </section>
  );
}
